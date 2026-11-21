import { Schema, model } from "mongoose";

/** One dashboard layout per person per workspace. */
const layoutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    widgets: [
      {
        _id: false,
        id: { type: String, required: true, maxlength: 40 },
        size: { type: String, enum: ["s", "m", "l", "xl"], default: "m" },
        hidden: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);
layoutSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });

export const DashboardLayout = model<any>("DashboardLayout", layoutSchema);