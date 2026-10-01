import mongoose, { type Document, type Model, Schema } from "mongoose";

export type ResetStatus = "pending" | "resolved" | "rejected";

export interface IPasswordResetRequest extends Document {
  email: string;
  preferredPassword: string;
  status: ResetStatus;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetRequestSchema = new Schema<IPasswordResetRequest>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    preferredPassword: { type: String, required: true },
    status: { type: String, enum: ["pending", "resolved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

export const PasswordResetRequest: Model<IPasswordResetRequest> =
  mongoose.models.PasswordResetRequest ??
  mongoose.model<IPasswordResetRequest>("PasswordResetRequest", passwordResetRequestSchema);
