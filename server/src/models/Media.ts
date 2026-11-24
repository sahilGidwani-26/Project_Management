import { Schema, model } from "mongoose";

/** Profile photos and workspace logos (small, already resized in the browser). */
const mediaSchema = new Schema(
  {
    kind: { type: String, enum: ["user", "workspace"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    mime: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);
mediaSchema.index({ kind: 1, ownerId: 1 }, { unique: true });

export const Media = model<any>("Media", mediaSchema);