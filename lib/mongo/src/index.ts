import mongoose from "mongoose";

let isConnected = false;

export async function connectMongo(): Promise<void> {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  isConnected = true;
}

export function getMongoose() {
  return mongoose;
}

export * from "./models/index";
