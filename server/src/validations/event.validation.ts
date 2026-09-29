import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const httpUrl = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, "Link must start with http:// or https://");
const optionalLink = z.union([z.literal(""), httpUrl]).optional();

export const createEventSchema = z.object({
  body: z
    .object({
      workspaceId: objectId,
      type: z.enum(["meeting", "event"]).default("meeting"),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(),
      location: z.string().max(300).optional(),
      meetingLink: optionalLink,
      startTime: z.string().datetime(),
      endTime: z.string().datetime(),
      timezone: z.string().max(60).optional(),
      attendeeIds: z.array(objectId).max(100).default([]),
      notifyAttendees: z.boolean().default(true),
    })
    .refine((d) => new Date(d.endTime).getTime() > new Date(d.startTime).getTime(), {
      message: "End time must be after start time",
      path: ["endTime"],
    }),
  query: z.any(),
  params: z.any(),
});

export const updateEventSchema = z.object({
  body: z.object({
    type: z.enum(["meeting", "event"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(300).optional(),
    meetingLink: optionalLink,
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    timezone: z.string().max(60).optional(),
    attendeeIds: z.array(objectId).max(100).optional(),
    notifyAttendees: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const notesSchema = z.object({
  body: z.object({ notes: z.string().max(20000) }),
  query: z.any(),
  params: z.any(),
});