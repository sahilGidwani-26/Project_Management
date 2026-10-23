import { Schema, model } from "mongoose";

const roleSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    nameLower: { type: String, required: true },
    description: { type: String, default: "", maxlength: 200 },
    color: { type: String, default: "#64748B" },
    /** Set only for the 5 built-in roles of a workspace. Custom roles have no systemKey. */
    systemKey: { type: String, enum: ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"] },
    /** "all" = every project of the workspace, "member" = only projects the person belongs to */
    scope: { type: String, enum: ["all", "member"], default: "all" },
    permissions: [String],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

roleSchema.index({ workspaceId: 1, nameLower: 1 }, { unique: true });
roleSchema.index({ workspaceId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } });

export const AccessRole = model<any>("AccessRole", roleSchema);