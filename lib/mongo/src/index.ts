import mongoose from "mongoose";

// Single shared connect promise — prevents multiple concurrent mongoose.connect()
// calls if several requests arrive before the initial connection is established.
let connectPromise: Promise<void> | null = null;

export function connectMongo(): Promise<void> {
  if (connectPromise) return connectPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  connectPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      // Pool of 10 allows auth/app routes to get a connection even while
      // background log writes are in flight.  Each connection ~1-2 MB.
      maxPoolSize: 10,
      // Fail fast if all pool slots are busy rather than queuing forever.
      waitQueueTimeoutMS: 8000,
    })
    .then(() => undefined)
    .catch((err) => {
      // Reset so the next caller triggers a fresh attempt.
      connectPromise = null;
      throw err;
    });

  return connectPromise;
}

export function getMongoose() {
  return mongoose;
}

export * from "./models/index";
