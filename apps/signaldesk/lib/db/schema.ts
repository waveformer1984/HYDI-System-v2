import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'admin', 'member']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  passwordHash: text('password_hash'),
  timezone: text('timezone').default('America/Chicago'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  websiteUrl: text('website_url'),
  demoMode: boolean('demo_mode').notNull().default(false),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceUserUid: uniqueIndex('memberships_workspace_user').on(t.workspaceId, t.userId),
  }),
);

export const workspaceProfiles = pgTable('workspace_profiles', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agencyName: text('agency_name'),
  servicesOffered: jsonb('services_offered').$type<string[]>().default([]),
  targetIndustries: jsonb('target_industries').$type<string[]>().default([]),
  targetLocations: jsonb('target_locations').$type<string[]>().default([]),
  idealBusinessNotes: text('ideal_business_notes'),
  senderDisplayName: text('sender_display_name'),
  senderReplyEmail: text('sender_reply_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  monthlyCents: integer('monthly_cents').notNull(),
  seatLimit: integer('seat_limit').notNull(),
  researchCreditsPerPeriod: integer('research_credits_per_period').notNull(),
  stripePriceIdEnvKey: text('stripe_price_id_env_key').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});