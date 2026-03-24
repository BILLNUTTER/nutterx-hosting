import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IPesapalSettings extends Document {
  consumerKey: string;
  consumerSecret: string;
  ipnId: string;
  isProduction: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pesapalSettingsSchema = new Schema<IPesapalSettings>(
  {
    consumerKey: { type: String, default: "" },
    consumerSecret: { type: String, default: "" },
    ipnId: { type: String, default: "" },
    isProduction: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const PesapalSettings: Model<IPesapalSettings> =
  mongoose.models.PesapalSettings ??
  mongoose.model<IPesapalSettings>("PesapalSettings", pesapalSettingsSchema);
