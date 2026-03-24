import mongoose, { type Document, type Model, Schema, type Types } from "mongoose";
import { type IEnvVar, envVarSchema } from "./EnvVar.js";

export type { IEnvVar };

export type AppStatus = "idle" | "installing" | "running" | "stopped" | "crashed" | "error";

export interface IApp extends Document {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  name: string;
  repoUrl: string;
  pat?: string;
  slug: string;
  status: AppStatus;
  autoRestart: boolean;
  startCommand?: string;
  installCommand?: string;
  workDir?: string;
  port?: number;
  envVars: IEnvVar[];
  lastDeployedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appSchema = new Schema<IApp>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    repoUrl: { type: String, required: true, trim: true },
    pat: { type: String },
    slug: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: ["idle", "installing", "running", "stopped", "crashed", "error"],
      default: "idle",
    },
    autoRestart: { type: Boolean, default: false },
    startCommand: { type: String },
    installCommand: { type: String },
    workDir: { type: String },
    port: { type: Number },
    envVars: { type: [envVarSchema], default: [] },
    lastDeployedAt: { type: Date },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

export const App: Model<IApp> =
  mongoose.models.App ?? mongoose.model<IApp>("App", appSchema);
