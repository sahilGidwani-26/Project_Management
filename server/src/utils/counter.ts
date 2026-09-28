import { Counter } from "../models/Counter";

/** Atomically returns the next sequence number for the given scope (creates it at 1 if new). */
export async function getNextSequence(scope: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { scope },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}