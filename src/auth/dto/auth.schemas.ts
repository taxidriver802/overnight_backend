import { z } from "zod";

export const loginBodySchema = z.object({
  employee_id: z.string().min(1, "employee_id is required"),
  pin: z.string().min(4).max(6, "PIN must be 4–6 characters"),
  device_id: z.string().min(1, "device_id is required"),
});

export const refreshBodySchema = z.object({
  refresh_token: z.string().min(1, "refresh_token is required"),
  device_id: z.string().min(1, "device_id is required"),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
