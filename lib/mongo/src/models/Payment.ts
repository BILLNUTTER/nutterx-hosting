import mongoose, { type Document, type Model, Schema } from "mongoose";

export type PaymentStatus = "pending" | "completed" | "failed" | "invalid";

export interface IPayment extends Document {
  userId: mongoose.Types.ObjectId;
  email: string;
  phone: string;
  amount: number;
  currency: string;
  pesapalOrderId: string;
  pesapalTrackingId: string;
  status: PaymentStatus;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    email: { type: String, required: true },
    phone: { type: String, default: "" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "KES" },
    pesapalOrderId: { type: String, required: true, unique: true },
    pesapalTrackingId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "invalid"],
      default: "pending",
    },
    description: {
      type: String,
      default: "Nutterx Hosting – 1 Month Subscription",
    },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ pesapalTrackingId: 1 });

export const Payment: Model<IPayment> =
  mongoose.models.Payment ??
  mongoose.model<IPayment>("Payment", paymentSchema);
