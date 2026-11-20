import { z } from "zod";

export const productQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().optional(),
});

export const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(10),
});

export const createOrderSchema = z.object({
  customerName: z.string().min(1).max(100),
  customerEmail: z.string().email(),
  items: z
    .array(orderItemSchema)
    .min(1)
    .max(10)
    .refine(
      (items) => new Set(items.map((i) => i.productId)).size === items.length,
      { message: "duplicate productId" },
    ),
});

export const reportQuerySchema = z.object({
  complexity: z.coerce.number().int().min(1).max(10).default(3),
});
