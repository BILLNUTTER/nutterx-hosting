import mongoose, { type Document, type Model, Schema } from "mongoose";

export type UserStatus = "active" | "suspended" | "deactivated";

export interface IUser extends Document {
  email: string;
  phone: string;
  passwordHash: string;
  refreshTokens: string[];
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    passwordHash: { type: String, required: true },
    refreshTokens: { type: [String], default: [] },
    status: { type: String, enum: ["active", "suspended", "deactivated"], default: "active" },
  },
  { timestamps: true }
);

export const User: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>("User", userSchema);
