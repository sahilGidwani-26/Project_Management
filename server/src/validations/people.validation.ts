import { z } from "zod";

const role = z.enum(["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"]);
const loose = z.record(z.any()).optional(); // field-by-field checks (lengths, phone, dates) are done in services/people.ts

export const createMemberSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    name: z.string().trim().min(2).max(100).optional(),
    role: role.default("MEMBER"),
    password: z.string().max(72).optional(),
    sendLoginDetails: z.boolean().optional(),
    profile: loose,
    personal: loose,
    joinedAt: z.string().optional().nullable(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateMemberSchema = z.object({
  body: z.object({
    role: role.optional(),
    profile: loose,
    personal: loose,
    joinedAt: z.string().optional().nullable(),
  }),
  query: z.any(),
  params: z.any(),
});