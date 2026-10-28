import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const dafOverlays = pgTable(
  "daf_overlays",
  {
    id: serial("id").primaryKey(),
    tractate: text("tractate").notNull(),
    daf: integer("daf").notNull(),
    amud: text("amud").notNull(),
    bookId: integer("book_id"),
    algo: integer("algo").notNull(),
    bubbleCount: integer("bubble_count").notNull().default(0),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("daf_overlays_key").on(table.tractate, table.daf, table.amud)],
);

export const dafVisits = pgTable("daf_visits", {
  id: serial("id").primaryKey(),
  tractate: text("tractate").notNull(),
  daf: integer("daf").notNull(),
  amud: text("amud").notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true }).defaultNow().notNull(),
});
