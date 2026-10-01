import { Schema } from "mongoose";

export interface IEnvVar {
  key: string;
  value: string;
}

export const envVarSchema = new Schema<IEnvVar>(
  {
    key: { type: String, required: true },
    value: { type: String, default: "" },
  },
  { _id: false }
);
