import mongoose, { type Document, type Model, Schema, type Types } from "mongoose";

export interface ILog extends Document {
  appId: Types.ObjectId;
  line: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: Date;
}

const logSchema = new Schema<ILog>(
  {
    appId: { type: Schema.Types.ObjectId, ref: "App", required: true, index: true },
    line: { type: String, required: true },
    stream: { type: String, enum: ["stdout", "stderr", "system"], default: "stdout" },
    timestamp: { type: Date, default: () => new Date() },
  },
  {
    capped: { size: 10 * 1024 * 1024, max: 10000 },
    timestamps: false,
  }
);

export const Log: Model<ILog> =
  mongoose.models.Log ?? mongoose.model<ILog>("Log", logSchema);
