import mongoose, { type Document, type Model, Schema } from "mongoose";

export type SubscriptionStatus = "active" | "expired";

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  email: string;
  status: SubscriptionStatus;
  paidAt: Date;
  expiresAt: Date;
  amount: number;
  currency: string;
  paymentId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    email: { type: String, required: true },
    status: { type: String, enum: ["active", "expired"], default: "active" },
    paidAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "KES" },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ expiresAt: 1 });

export const Subscription: Model<ISubscription> =
  mongoose.models.Subscription ??
  mongoose.model<ISubscription>("Subscription", subscriptionSchema);
