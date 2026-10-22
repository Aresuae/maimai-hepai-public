import type { CartLine, MenuItem, Quote } from "../domain/types.ts";

/** Future provider port. No live implementation exists yet. */
export interface MealContext {
  storeId: string;
  diningMode: "pickup";
  menuSnapshotId: string;
}

export interface MealProvider {
  readonly source: "demo" | "live";
  getMenu(context: MealContext): Promise<MenuItem[]>;
  quote(context: MealContext, lines: CartLine[]): Promise<Quote>;
}
