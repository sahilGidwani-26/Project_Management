import { Schema, model, Document, Types } from "mongoose";

export type WorkspaceRole = "OWNER" | "ADMIN" | "PROJECT_MANAGER" | "MEMBER" | "VIEWER";
export type MemberStatus = "active" | "deactivated" | "removed";

export interface IWorkspaceMember extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  /** "deactivated" = account paused (data stays, no access). "removed" = left the workspace. Only "active" can use the workspace. */
  status: MemberStatus;
  joinedAt: Date;
  profile?: {
    designation?: string;
    department?: string;
    employeeId?: string;
    company?: string;
    employmentType?: "full_time" | "part_time" | "contractor" | "intern" | "client" | "vendor";
    workLocation?: string;
    skills?: string[];
    reportingManagerId?: Types.ObjectId;
  };
  /** Private: only workspace Owner/Admin and the person themself can read this. */
  personal?: {
    phone?: string;
    alternatePhone?: string;
    dateOfBirth?: Date;
    address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; postalCode?: string };
    emergencyContact?: { name?: string; phone?: string; relation?: string };
  };
  addedBy?: Types.ObjectId;
  addedVia?: "owner" | "invite" | "manual";
  deactivatedAt?: Date;
  deactivatedBy?: Types.ObjectId;
}

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: {
      type: String,
      enum: ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"],
      default: "MEMBER",
    },
    status: { type: String, enum: ["active", "deactivated", "removed"], default: "active" },
    joinedAt: { type: Date, default: Date.now },
    profile: {
      designation: String,
      department: String,
      employeeId: String,
      company: String,
      employmentType: { type: String, enum: ["full_time", "part_time", "contractor", "intern", "client", "vendor"] },
      workLocation: String,
      skills: [String],
      reportingManagerId: { type: Schema.Types.ObjectId, ref: "User" },
    },
    personal: {
      phone: String,
      alternatePhone: String,
      dateOfBirth: Date,
      address: { line1: String, line2: String, city: String, state: String, country: String, postalCode: String },
      emergencyContact: { name: String, phone: String, relation: String },
    },
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
    addedVia: { type: String, enum: ["owner", "invite", "manual"] },
    deactivatedAt: Date,
    deactivatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMemberSchema.index({ workspaceId: 1, status: 1 });

export const WorkspaceMember = model<IWorkspaceMember>("WorkspaceMember", workspaceMemberSchema);