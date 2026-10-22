export type CheckoutView = {
  id: string; state: "prepared" | "submitting" | "unknown" | "created" | "finished";
  storeCode: string; amountCents: number; expiresAt: number;
  products: { productName: string; quantity: number; subtotal: number }[];
  takeWays: { code: string; title: string; subtitle?: string }[];
  memberNames?: string[];
  orderId?: string; payUrl?: string; orderStatus?: string; pickupCode?: string; expirePayTime?: string;
};
