import { Schema, model, Document } from "mongoose";

/**
 * Generic atomic counter, used to generate short human-readable IDs like
 * "TASK-42" per workspace (scope = `task:<workspaceId>`), without clashing
 * under concurrent requests.
 */
export interface ICounter extends Document {
  scope: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  scope: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model<ICounter>("Counter", counterSchema);