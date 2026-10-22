export type MainChoice = "chicken" | "beef" | "fish";
export type DrinkChoice = "none" | "cola" | "coffee";
export type FriesChoice = "must" | "nice" | "no";

export interface Preferences {
  budgetCents: number;
  main: MainChoice;
  drink: DrinkChoice;
  fries: FriesChoice;
  acceptsSharing: boolean;
  excludedMains?: MainChoice[];
}

export type PaymentPolicy =
  | { mode: "split" }
  | {
      mode: "treat";
      payerId: string;
      totalBudgetCents: number;
    };

export interface VoteState {
  round: number;
  phase: "idle" | "open" | "closed" | "resolved";
  ballots: Record<string, string>;
}

export interface Member {
  id: string;
  name: string;
  color: string;
  preferences: Preferences;
}

export interface MenuItem {
  id: string;
  name: string;
  kind: "main" | "drink" | "side";
  priceCents: number;
  main?: MainChoice;
  drink?: Exclude<DrinkChoice, "none">;
  shared?: boolean;
}

export interface CartLine {
  itemId: string;
  quantity: number;
  memberIds: string[];
}

export interface Allocation {
  memberId: string;
  totalCents: number;
  payableCents: number;
  items: { name: string; amountCents: number; shared: boolean }[];
  notes: string[];
}

export interface Quote {
  source: "demo" | "live";
  totalCents: number;
  quotedAt: number;
  expiresAt: number;
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  roomRevision: number;
  payment: PaymentPolicy;
  lines: CartLine[];
  allocations: Allocation[];
  quote: Quote;
}

export interface RoomState {
  revision: number;
  proposalVersion: number;
  members: Member[];
  payment: PaymentPolicy;
  vote: VoteState;
  phase: "collecting" | "reviewing" | "confirmed";
  plans: Plan[];
  selectedPlanId: string | null;
  confirmations: Record<string, number>;
}
